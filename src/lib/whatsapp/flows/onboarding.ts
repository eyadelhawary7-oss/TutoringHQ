/**
 * WhatsApp onboarding Flow 1 — 8-message automated sequence
 * Schedule: +0min, +2hrs, +1d, +2d, +3d, +5d, +7d, +14d
 */

import { createClient } from '@supabase/supabase-js';
import { sendTemplateMessage, normalizePhone } from '../client';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://centerhq.app';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Schedule offsets in minutes */
const SCHEDULE_OFFSETS: Record<number, number> = {
  1: 0,
  2: 2 * 60, // 2 hours
  3: 24 * 60, // 1 day
  4: 48 * 60, // 2 days
  5: 72 * 60, // 3 days
  6: 120 * 60, // 5 days
  7: 168 * 60, // 7 days
  8: 336 * 60, // 14 days
};

/**
 * Schedule the 8-step onboarding flow for a center.
 * Inserts 8 rows with scheduled_for at the specified offsets.
 */
export async function scheduleOnboardingFlow(
  centerId: string,
  phone: string
): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date();

  const rows = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((step) => {
    const offsetMs = (SCHEDULE_OFFSETS[step] ?? 0) * 60 * 1000;
    const scheduledFor = new Date(now.getTime() + offsetMs);
    return {
      center_id: centerId,
      to_phone: phone,
      step,
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending',
    };
  });

  await (admin as unknown as { from: (t: string) => { upsert: (d: object[], o: { onConflict: string }) => Promise<unknown> } })
    .from('wa_onboarding_schedule')
    .upsert(rows, { onConflict: 'center_id,step' });
}

/**
 * Pause remaining onboarding steps for a center (e.g. when user reports a problem).
 */
export async function pauseOnboardingFlow(centerId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await (admin as unknown as {
    from: (t: string) => {
      update: (d: object) => { eq: (a: string, b: string) => { eq: (a2: string, b2: string) => Promise<unknown> } };
    };
  })
    .from('wa_onboarding_schedule')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('center_id', centerId)
    .eq('status', 'pending');
}

/**
 * Check if center is in human queue (paused due to problem report).
 */
async function isInHumanQueue(admin: ReturnType<typeof getSupabaseAdmin>, centerId: string, phone: string): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const { data } = await admin
    .from('wa_conversations')
    .select('is_in_human_queue')
    .eq('center_id', centerId)
    .eq('contact_phone', normalized)
    .maybeSingle();
  return (data as { is_in_human_queue?: boolean } | null)?.is_in_human_queue === true;
}

/**
 * Get week 1 stats for step 7: scans last 7 days, student count, SUM confirmed payments.
 */
async function getWeek1Stats(
  admin: ReturnType<typeof getSupabaseAdmin>,
  centerId: string
): Promise<{ scansLast7Days: number; studentCount: number; confirmedPaymentsSum: number }> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [scansRes, studentsRes, paymentsRes] = await Promise.all([
    admin.from('attendance_scans').select('id', { count: 'exact', head: true }).eq('center_id', centerId).gte('scanned_at', sevenDaysAgo.toISOString()),
    admin.from('students').select('id', { count: 'exact', head: true }).eq('center_id', centerId),
    admin.from('payments').select('amount').eq('center_id', centerId).eq('status', 'confirmed').gte('paid_at', sevenDaysAgo.toISOString()),
  ]);

  const scansLast7Days = (scansRes as { count?: number })?.count ?? 0;
  const studentCount = (studentsRes as { count?: number })?.count ?? 0;
  const payments = (paymentsRes as { data?: { amount: number }[] })?.data ?? [];
  const confirmedPaymentsSum = payments.reduce((s, p) => s + (p.amount ?? 0), 0);

  return { scansLast7Days, studentCount, confirmedPaymentsSum };
}

/**
 * Get center's referral code and build signup link.
 */
async function getReferralLink(admin: ReturnType<typeof getSupabaseAdmin>, centerId: string): Promise<string> {
  const { data } = await admin.from('centers').select('referral_code').eq('id', centerId).single();
  const code = (data as { referral_code?: string } | null)?.referral_code ?? '';
  return `${APP_URL}/ar/signup?ref=${encodeURIComponent(code)}`;
}

/**
 * Process a single onboarding step: send the correct template.
 */
export async function processOnboardingStep(
  centerId: string,
  toPhone: string,
  step: number
): Promise<{ success: boolean; skipped?: boolean }> {
  const admin = getSupabaseAdmin();

  if (step === 5) {
    const inQueue = await isInHumanQueue(admin, centerId, toPhone);
    if (inQueue) {
      return { success: true, skipped: true };
    }
  }

  switch (step) {
    case 1: {
      const loginUrl = `${APP_URL}/ar/login`;
      await sendTemplateMessage(centerId, toPhone, 'chq_welcome', {
        '1': loginUrl,
      });
      break;
    }
    case 2:
      await sendTemplateMessage(centerId, toPhone, 'chq_onboarding_step1', {});
      break;
    case 3:
      await sendTemplateMessage(centerId, toPhone, 'chq_onboarding_step2', {});
      break;
    case 4:
      await sendTemplateMessage(centerId, toPhone, 'chq_onboarding_step3', {});
      break;
    case 5:
      await sendTemplateMessage(centerId, toPhone, 'chq_checkin_day3', {});
      break;
    case 6:
      await sendTemplateMessage(centerId, toPhone, 'chq_payments_guide', {});
      break;
    case 7: {
      const stats = await getWeek1Stats(admin, centerId);
      await sendTemplateMessage(centerId, toPhone, 'chq_week1_summary', {
        '1': String(stats.scansLast7Days),
        '2': String(stats.studentCount),
        '3': String(Math.round(stats.confirmedPaymentsSum)),
      });
      break;
    }
    case 8: {
      const referralLink = await getReferralLink(admin, centerId);
      await sendTemplateMessage(centerId, toPhone, 'chq_referral_intro', {
        '1': referralLink,
        '2': '25',
      });
      break;
    }
    default:
      return { success: false };
  }

  return { success: true };
}

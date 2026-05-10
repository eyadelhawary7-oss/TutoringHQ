import { calendarAddDaysYmd } from '@/lib/billingSchedule';
import { todayISO } from '@/lib/parentPack';

export type SubscriptionPastDueCenter = {
  status?: string | null;
  subscription_status?: string | null;
  billing_status?: string | null;
  next_payment_due?: string | null;
};

/**
 * True when the centre should see overdue payment UX (banner, billing warnings).
 * Does not apply when already fully suspended (different flows).
 */
export function isSubscriptionPastDueBanner(center: SubscriptionPastDueCenter): boolean {
  const st = (center.status ?? '').toLowerCase();
  const sub = (center.subscription_status ?? '').toLowerCase();
  const bs = (center.billing_status ?? '').toLowerCase();
  if (st === 'suspended' || sub === 'suspended') return false;
  if (sub === 'cancelled') return false;
  if (sub === 'overdue') return true;
  if (bs === 'overdue') return true;

  const npd = center.next_payment_due?.slice(0, 10);
  if (!npd) return false;
  const today = todayISO();
  if (npd < today && (st === 'active' || st === 'pending_cancellation')) return true;
  return false;
}

/** YYYY-MM-DD when access will be suspended if unpaid (from DB). */
export function autoSuspendDateYmd(autoSuspendAt: string | null | undefined): string | null {
  if (!autoSuspendAt || typeof autoSuspendAt !== 'string') return null;
  return autoSuspendAt.slice(0, 10);
}

/**
 * Test helper: true when `todayYmd` is on or after the first suspension day
 * implied by due date + grace calendar days.
 */
export function shouldSuspendAfterGrace(
  nextPaymentDueYmd: string,
  graceCalendarDays: number,
  todayYmd: string,
): boolean {
  const suspendOn = calendarAddDaysYmd(nextPaymentDueYmd, graceCalendarDays);
  return todayYmd >= suspendOn;
}

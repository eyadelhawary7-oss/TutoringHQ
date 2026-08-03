import type { SupabaseClient } from '@supabase/supabase-js';
import { isTemplateApproved, waSendingEnabled } from '@/lib/centerNotify';
import { formatDate } from '@/lib/formatNumber';

/**
 * Manual "Send reminder" on Merged-Teacher-Students §02 — the gate, shared by
 * the detail GET (which renders the button disabled with a visible reason) and
 * the send POST (which re-evaluates from scratch and never trusts the client).
 *
 * ── THE ONE CONFIG POINT ────────────────────────────────────────────────────
 * platform_config key `teacher.fee_reminder.manual_enabled`, a boolean. A
 * MISSING row reads as false, so the placeholder is the absence of the row:
 * shipping this needs no seed write and no migration. Turning it on is one
 * INSERT/UPDATE on platform_config — nothing else in the code changes.
 *
 * It is deliberately not the only gate. The Meta template `chq_fee_reminder`
 * is PENDING today, so even with the flag on nothing can send: isTemplateApproved
 * returns true only on 'APPROVED'. Both must be satisfied.
 *
 * ── FAIL VISIBLY ────────────────────────────────────────────────────────────
 * Every stop is a named reason the UI prints under a disabled button. There is
 * no path here that reports a send that did not happen, and no path that
 * fabricates a "reminded on <date>" stamp.
 */
export const MANUAL_FEE_REMINDER_CONFIG_KEY = 'teacher.fee_reminder.manual_enabled';

export const FEE_REMINDER_TEMPLATE = 'chq_fee_reminder';

/** Same ceiling the nightly cron enforces, so the two paths cannot double-send. */
export const MAX_FEE_REMINDERS = 2;

/**
 * Template body param {{3}} when the teacher entered no payment details:
 * no fabricated handles, no link — just a plain ask. Shared with the cron so a
 * manual reminder and an automatic one degrade to the identical message.
 */
export const FEE_REMINDER_FALLBACK_TEXT = 'برجاء إرسال رسوم الحصة.';

const DAY_MS = 24 * 60 * 60 * 1000;
const CAIRO_TZ = 'Africa/Cairo';

const PAYMENT_METHODS = ['cash', 'instapay', 'vodafone_cash', 'other'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type TeacherPaymentProfile = {
  instapay_address: string | null;
  wallet_phone: string | null;
  payment_phone: string | null;
  accepted_methods: string[] | null;
  default_payment_method: string | null;
};

/** Arabic label for a payment method (matches the teacher settings copy). */
const METHOD_LABEL_AR: Record<PaymentMethod, string> = {
  cash: 'كاش',
  instapay: 'إنستا باي',
  vodafone_cash: 'فودافون كاش',
  other: 'غير كده',
};

function methodDetail(profile: TeacherPaymentProfile, method: PaymentMethod): string | null {
  switch (method) {
    case 'instapay':
      return profile.instapay_address
        ? `${METHOD_LABEL_AR.instapay}: ${profile.instapay_address}`
        : METHOD_LABEL_AR.instapay;
    case 'vodafone_cash':
      return profile.wallet_phone
        ? `${METHOD_LABEL_AR.vodafone_cash}: ${profile.wallet_phone}`
        : METHOD_LABEL_AR.vodafone_cash;
    case 'cash':
      // Cash needs no handle; the payment_phone (if any) is a coordination number.
      return profile.payment_phone
        ? `${METHOD_LABEL_AR.cash} (${profile.payment_phone})`
        : METHOD_LABEL_AR.cash;
    case 'other':
      return profile.payment_phone
        ? `${METHOD_LABEL_AR.other}: ${profile.payment_phone}`
        : null;
    default:
      return null;
  }
}

/**
 * Builds the payment-details line for the reminder: the teacher's DEFAULT method
 * first, then the other accepted methods. Returns null when the teacher has
 * entered no usable payment details at all (no handles AND no accepted methods),
 * which signals the fallback path.
 *
 * Template body param {{3}}. Moved verbatim from the nightly fee-reminders cron
 * so the manual Send-reminder button and the cron build the identical line.
 */
export function buildPaymentDetails(profile: TeacherPaymentProfile): string | null {
  const accepted = (profile.accepted_methods ?? []).filter(
    (m): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m),
  );
  const hasAnyHandle = Boolean(
    profile.instapay_address || profile.wallet_phone || profile.payment_phone,
  );
  if (accepted.length === 0 && !hasAnyHandle) {
    return null;
  }

  const ordered: PaymentMethod[] = [];
  const def = profile.default_payment_method;
  if (def && (PAYMENT_METHODS as readonly string[]).includes(def) && accepted.includes(def as PaymentMethod)) {
    ordered.push(def as PaymentMethod);
  }
  for (const m of accepted) {
    if (!ordered.includes(m)) ordered.push(m);
  }

  // No accepted methods but a handle exists: infer from the handle.
  if (ordered.length === 0) {
    if (profile.instapay_address) ordered.push('instapay');
    else if (profile.wallet_phone) ordered.push('vodafone_cash');
    else if (profile.payment_phone) ordered.push('other');
  }

  const lines = ordered
    .map((m) => methodDetail(profile, m))
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) return null;
  return lines.join('\n');
}

/**
 * Best-effort next class date for a group from group_schedule (recurring weekly
 * slots, day_of_week 0=Sun..6=Sat). Returns a Cairo-formatted Arabic date string
 * for the soonest upcoming slot, or '' when no schedule exists.
 *
 * Template body param {{4}}. Moved verbatim from the nightly fee-reminders cron.
 */
export function nextClassDate(
  scheduleRows: { day_of_week: number }[] | null | undefined,
): string {
  if (!scheduleRows || scheduleRows.length === 0) return '';

  // Today's day-of-week in Cairo (0=Sun..6=Sat) via en-US weekday.
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayName = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    weekday: 'long',
  })
    .format(new Date())
    .toLowerCase();
  const todayDow = weekdayNames.indexOf(todayName);
  if (todayDow < 0) return '';

  let minAhead = 8;
  for (const row of scheduleRows) {
    const dow = Number(row.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
    // Days until the next occurrence (>=1, so we always point to a future class).
    let ahead = dow - todayDow;
    if (ahead <= 0) ahead += 7;
    if (ahead < minAhead) minAhead = ahead;
  }
  if (minAhead > 7) return '';

  const target = new Date(Date.now() + minAhead * DAY_MS);
  return formatDate(target, 'ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: CAIRO_TZ,
  });
}

export type FeeReminderBlock =
  | 'reminder_disabled'
  | 'wa_disabled'
  | 'template_not_approved'
  | 'no_pending_charges'
  | 'no_payer_phone'
  | 'reminder_cap_reached';

export type RemindableCharge = {
  id: string;
  payer_phone: string | null;
  fee_reminder_count: number | null;
};

/** The oldest pending charge that still has somewhere to send and reminders left. */
export function pickRemindableCharge<T extends RemindableCharge>(pending: T[]): T | null {
  return (
    pending.find(
      (p) => Boolean(p.payer_phone) && Number(p.fee_reminder_count ?? 0) < MAX_FEE_REMINDERS,
    ) ?? null
  );
}

/** Opt-IN switch: missing row, read error and any non-`true` value all mean off. */
async function manualRemindersEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin
    .from('platform_config')
    .select('value')
    .eq('key', MANUAL_FEE_REMINDER_CONFIG_KEY)
    .maybeSingle();
  // Fail closed on a read error too - a blip must never be read as consent.
  if (error || !data) return false;
  return data.value === true;
}

/**
 * Returns null when a manual reminder can actually be sent for one of these
 * pending charges, or the reason it cannot. Checked in the order the UI should
 * explain them: platform switch, WhatsApp switch, template approval, then the
 * charge-level facts.
 */
export async function resolveFeeReminderBlock(
  admin: SupabaseClient,
  pending: RemindableCharge[],
): Promise<FeeReminderBlock | null> {
  if (!(await manualRemindersEnabled(admin))) return 'reminder_disabled';

  // The platform-wide WhatsApp kill switch, read through the same helper every
  // other sender uses (absent row = on, only an explicit `false` is off).
  if (!(await waSendingEnabled(admin))) return 'wa_disabled';

  if (!(await isTemplateApproved(FEE_REMINDER_TEMPLATE, admin))) return 'template_not_approved';

  if (pending.length === 0) return 'no_pending_charges';
  if (!pending.some((p) => Boolean(p.payer_phone))) return 'no_payer_phone';
  if (!pickRemindableCharge(pending)) return 'reminder_cap_reached';

  return null;
}

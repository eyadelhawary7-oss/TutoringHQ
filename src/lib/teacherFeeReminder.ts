import type { SupabaseClient } from '@supabase/supabase-js';
import { isTemplateApproved, waSendingEnabled } from '@/lib/centerNotify';

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

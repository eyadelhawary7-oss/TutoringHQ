// src/lib/summer/dates.ts
//
// Pure date math for the Summer-2026 automatic free-period + trial + first-invoice
// schedule. Every date is an Africa/Cairo CALENDAR date (YYYY-MM-DD); the only
// instant produced is `lock_at`, which is 00:00 Africa/Cairo of the lock day,
// returned as a UTC ISO string. No `new Date()` for windows — all math runs on
// Cairo calendar days via the cairo/ helpers, exactly like the billing engine.
//
// The rules (plain terms, from the build brief):
//   trial_start      = max(signup_date, SUMMER_FREE_UNTIL)
//   raw_trial_end    = trial_start + TRIAL_DAYS
//   first_invoice_at = max(raw_trial_end, FIRST_CHARGE_FLOOR)   // never before the floor
//   lock_at          = first_invoice_at + PAY_WINDOW_DAYS @ 00:00 Africa/Cairo
//
// Worked examples (validated by tests/unit/summerDates.test.ts):
//   join Jul 10 → trial_start Aug 16 → invoice Aug 30 → pay Aug 30 & 31 → lock Sep 1 00:00
//   join Aug 14 → same as above (invoice Aug 30, lock Sep 1)
//   join Aug 20 → trial_start Aug 20 → invoice Sep 3 → pay Sep 3 & 4 → lock Sep 5 00:00

import {
  cairoDateKey,
  cairoYmdPlusDays,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

/** The four admin-editable knobs that drive the schedule (Cairo dates + counts). */
export interface SummerScheduleConfig {
  /** SUMMER_FREE_UNTIL — free for everyone up to this Cairo date (default Aug 16 2026). */
  freeUntil: string;
  /** FIRST_CHARGE_FLOOR — first invoice never before this Cairo date (default Aug 30 2026). */
  firstChargeFloor: string;
  /** TRIAL_DAYS — trial length in calendar days from trial_start (default 14). */
  trialDays: number;
  /** PAY_WINDOW_DAYS — days the invoice is payable before the lock (default 2). */
  payWindowDays: number;
}

export interface SummerSchedule {
  /** Cairo date (YYYY-MM-DD) the 14-day trial starts. */
  trialStart: string;
  /** Cairo date (YYYY-MM-DD) the trial would end before the floor is applied. */
  rawTrialEnd: string;
  /** Cairo date (YYYY-MM-DD) the first invoice is issued — never before the floor. */
  firstInvoiceAt: string;
  /** Last Cairo date (YYYY-MM-DD) the invoice is still payable (inclusive). */
  lastPayableDay: string;
  /** Cairo date (YYYY-MM-DD) the account locks (00:00 Cairo of this day). */
  lockDay: string;
  /** The 00:00 Africa/Cairo instant of `lockDay`, as a UTC ISO string. */
  lockAtIso: string;
}

/** YYYY-MM-DD strings compare lexicographically when zero-padded, so max = the later one. */
function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Compute the full summer schedule for one customer from their signup Cairo date.
 *
 * @param signupDateCairo Cairo calendar date (YYYY-MM-DD) the customer joined.
 * @param cfg             The four admin-editable knobs.
 */
export function computeSummerSchedule(
  signupDateCairo: string,
  cfg: SummerScheduleConfig,
): SummerSchedule {
  const trialDays = Number.isFinite(cfg.trialDays) && cfg.trialDays >= 0 ? Math.floor(cfg.trialDays) : 14;
  const payWindowDays =
    Number.isFinite(cfg.payWindowDays) && cfg.payWindowDays >= 1 ? Math.floor(cfg.payWindowDays) : 2;

  const trialStart = maxYmd(signupDateCairo, cfg.freeUntil);
  const rawTrialEnd = cairoYmdPlusDays(trialStart, trialDays);
  const firstInvoiceAt = maxYmd(rawTrialEnd, cfg.firstChargeFloor);
  // Pay window covers PAY_WINDOW_DAYS days starting on the invoice day; the lock
  // fires at 00:00 Cairo on first_invoice_at + PAY_WINDOW_DAYS.
  const lastPayableDay = cairoYmdPlusDays(firstInvoiceAt, payWindowDays - 1);
  const lockDay = cairoYmdPlusDays(firstInvoiceAt, payWindowDays);

  return {
    trialStart,
    rawTrialEnd,
    firstInvoiceAt,
    lastPayableDay,
    lockDay,
    lockAtIso: startOfUtcInstantForCairoCalendarDay(lockDay).toISOString(),
  };
}

/** Convenience: the Cairo date (YYYY-MM-DD) for an instant (defaults to now). */
export function signupCairoDate(d: Date = new Date()): string {
  return cairoDateKey(d);
}

/**
 * Is `todayCairo` on/after the customer's first-invoice date? (i.e. an invoice is
 * due to be issued). Pure string compare on Cairo dates.
 */
export function isFirstInvoiceDue(firstInvoiceAt: string, todayCairo: string): boolean {
  return todayCairo >= firstInvoiceAt;
}

/**
 * Days remaining (>= 0) from `todayCairo` until the first invoice. 0 on/after the day.
 * Counts whole Cairo calendar days.
 */
export function daysUntilFirstInvoice(firstInvoiceAt: string, todayCairo: string): number {
  if (todayCairo >= firstInvoiceAt) return 0;
  let n = 0;
  let cursor = todayCairo;
  // Bounded walk — schedules are weeks apart, never years.
  while (cursor < firstInvoiceAt && n < 3650) {
    cursor = cairoYmdPlusDays(cursor, 1);
    n += 1;
  }
  return n;
}

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decideLockoutActions,
  buildLockoutTickConfig,
  type LockoutCenterState,
  type LockoutAction,
} from '@/lib/billingLockout';
import {
  startOfUtcInstantForCairoCalendarDay,
  cairoYmdPlusDays,
  cairoDateKey,
  getCurrentCairoClock,
} from '@/lib/cairo/day';

// The lock phase (23:59 Cairo) is only real if the ACTUAL cron schedule produces a
// tick whose Cairo minute-of-day reaches lockMins. PR #164 scheduled "0 * * * *" (on
// the hour); because Africa/Cairo is a whole-hour offset every tick lands at minute 0,
// so nowMins maxed at 1380 and the lock (1439) NEVER fired, yet a unit test that
// hand-fed 1439 stayed green. This suite drives the scheduler with the REAL cron
// minutes parsed from vercel.json and the REAL Africa/Cairo clock, so it fails (the
// lock never fires) under the old schedule and passes under "0,59 * * * *".

/** Parse the minute field of the billing-lockout cron from the real vercel.json. */
function billingLockoutCronMinutes(): number[] {
  const cfg = JSON.parse(
    readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8'),
  ) as { crons: { path: string; schedule: string }[] };
  const entry = cfg.crons.find((c) => c.path === '/api/cron/billing-lockout');
  if (!entry) throw new Error('billing-lockout cron missing from vercel.json');
  const [minuteField, hourField] = entry.schedule.split(/\s+/);
  // This proof assumes the cron runs every hour (hour field '*'); revisit if that changes.
  expect(hourField, 'billing-lockout cron must run every hour').toBe('*');
  return minuteField.split(',').map((m) => {
    const n = Number(m);
    if (!Number.isInteger(n) || n < 0 || n > 59) {
      throw new Error(`unsupported cron minute field for this proof: ${minuteField}`);
    }
    return n;
  });
}

/** Every real UTC instant the cron fires at during Cairo calendar day `cairoYmd`. */
function cronTicksDuringCairoDay(cairoYmd: string, minutes: number[]): Date[] {
  const start = startOfUtcInstantForCairoCalendarDay(cairoYmd).getTime();
  const end = startOfUtcInstantForCairoCalendarDay(cairoYmdPlusDays(cairoYmd, 1)).getTime();
  const ticks: Date[] = [];
  for (let t = start; t < end; t += 60_000) {
    const d = new Date(t);
    if (!minutes.includes(d.getUTCMinutes())) continue;
    if (cairoDateKey(d) !== cairoYmd) continue;
    ticks.push(d);
  }
  return ticks;
}

const config = buildLockoutTickConfig({
  retryTimesCairo: ['09:00', '14:00', '19:00'],
  reminderTimeCairo: '17:00',
  maxAttempts: 3,
});

/** Run a full Cairo day of real cron ticks, threading the ledger like the runner does. */
function simulateDay(cairoYmd: string, minutes: number[]) {
  const ticks = cronTicksDuringCairoDay(cairoYmd, minutes);
  let state: LockoutCenterState = {
    unpaid: true,
    attemptsMade: 0,
    hadSuccessfulRetry: false,
    done: { invoiceNudge: false, reminder2: false, lock: false },
  };
  const fired: Record<LockoutAction['kind'], number> = {
    invoice_nudge: 0,
    retry: 0,
    reminder2: 0,
    lock: 0,
  };
  for (const tick of ticks) {
    const { hour, minute } = getCurrentCairoClock(tick);
    const nowMins = hour * 60 + minute;
    for (const action of decideLockoutActions({ nowMins, config, state })) {
      fired[action.kind] += 1;
      if (action.kind === 'invoice_nudge') {
        state = { ...state, done: { ...state.done, invoiceNudge: true } };
      } else if (action.kind === 'retry') {
        state = { ...state, attemptsMade: state.attemptsMade + 1 };
      } else if (action.kind === 'reminder2') {
        state = { ...state, done: { ...state.done, reminder2: true } };
      } else if (action.kind === 'lock') {
        state = { ...state, done: { ...state.done, lock: true } };
      }
    }
  }
  return { fired, tickCount: ticks.length };
}

// Egypt observes DST (UTC+3) from the last Friday of April to the last Thursday of
// October; for 2026 that is 2026-04-24 .. 2026-10-29.
const DAYS: Array<[string, string]> = [
  ['winter (UTC+2)', '2026-02-15'],
  ['summer (UTC+3)', '2026-08-30'],
  ['spring-forward day (00:00 Cairo does not exist)', '2026-04-24'],
  ['fall-back day (a Cairo hour repeats)', '2026-10-29'],
];

describe('billing lockout: the real cron schedule reaches every phase exactly once', () => {
  const minutes = billingLockoutCronMinutes();

  it('a real tick reaches the lock minute-of-day (fails under "0 * * * *")', () => {
    for (const ymd of ['2026-02-15', '2026-08-30']) {
      const maxNowMins = Math.max(
        ...cronTicksDuringCairoDay(ymd, minutes).map((d) => {
          const { hour, minute } = getCurrentCairoClock(d);
          return hour * 60 + minute;
        }),
      );
      expect(maxNowMins, `max Cairo nowMins on ${ymd}`).toBeGreaterThanOrEqual(config.lockMins);
    }
  });

  for (const [label, ymd] of DAYS) {
    it(`${label}: invoice_nudge / reminder2 / lock each once, retries capped`, () => {
      const { fired, tickCount } = simulateDay(ymd, minutes);
      expect(tickCount, 'cron fired during the day').toBeGreaterThan(0);
      expect(fired.invoice_nudge, 'invoice+nudge once').toBe(1);
      expect(fired.reminder2, 'second reminder once').toBe(1);
      // This is 0 under the broken "0 * * * *" schedule -- the whole point of the fix.
      expect(fired.lock, 'lock fires exactly once').toBe(1);
      expect(fired.retry, 'retries capped at maxAttempts').toBe(3);
    });
  }
});

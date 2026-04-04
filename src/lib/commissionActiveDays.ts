/** Mirrors DB `compute_active_days` using `center_first_payment_date` + `clock_pause_log` on commissions. */

export type ClockPauseEntry = { paused_at: string; resumed_at?: string | null };

export function parseClockPauseLog(raw: unknown): ClockPauseEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ClockPauseEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.paused_at !== 'string') continue;
    out.push({
      paused_at: o.paused_at,
      resumed_at: typeof o.resumed_at === 'string' ? o.resumed_at : (o.resumed_at as null | undefined) ?? null,
    });
  }
  return out;
}

export function computeActiveDaysFromFirstPayment(
  firstPaymentDate: string,
  clockPauseLog: ClockPauseEntry[],
): number {
  const start = new Date(firstPaymentDate);
  const today = new Date();
  const totalDays = Math.floor((today.getTime() - start.getTime()) / 86400000);

  let pausedDays = 0;
  for (const entry of clockPauseLog) {
    const pausedAt = new Date(entry.paused_at);
    const resumedAt = entry.resumed_at ? new Date(entry.resumed_at) : today;
    pausedDays += Math.floor((resumedAt.getTime() - pausedAt.getTime()) / 86400000);
  }

  return Math.max(0, totalDays - pausedDays);
}

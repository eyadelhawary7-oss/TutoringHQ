'use client';

import { Loader2 } from 'lucide-react';

/**
 * The four loading states, to `Merged-Design-Patterns` §02.
 *
 * All four already existed in the app — `chq-skeleton` in 9 files, 11 route
 * `loading.tsx` files, and `LoadingButton` for in-flight actions. What did not
 * exist was a NAMED SET, so each screen invented its own shape and the four
 * states were not distinguishable from one another. §02's whole point is that
 * they are four different messages:
 *
 *   list, rows still arriving   → structure is known, content is not
 *   a record opening            → one thing, not a list
 *   slow, not an error          → it is still working; do not offer a retry
 *   action in flight            → you pressed something and it is happening
 *
 * The third is the one that matters and the one nobody builds. A list that has
 * been skeletal for eight seconds looks broken; saying "still working" is the
 * difference between a user waiting and a user reloading.
 */

/** §02 · list, rows still arriving. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
          aria-hidden
        >
          <div className="chq-skeleton h-10 w-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="chq-skeleton h-4 w-2/5 rounded-xs" />
            <div className="chq-skeleton mt-2 h-3 w-3/5 rounded-xs" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** §02 · a record opening — one thing, not a list. */
export function RecordSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-3" aria-hidden>
        <div className="chq-skeleton h-14 w-14 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="chq-skeleton h-5 w-1/2 rounded-xs" />
          <div className="chq-skeleton mt-2 h-3 w-1/3 rounded-xs" />
        </div>
      </div>
      <div className="flex gap-2" aria-hidden>
        <div className="chq-skeleton h-16 flex-1 rounded-md" />
        <div className="chq-skeleton h-16 flex-1 rounded-md" />
      </div>
    </div>
  );
}

/**
 * §02 · slow, not an error.
 *
 * Deliberately offers no retry. The design's caption is "slow, not an error" —
 * a retry button here invites the user to restart something that is already
 * working, which is how a slow request becomes two slow requests.
 */
export function StillWorking({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--color-muted)]" aria-hidden />
      <p className="text-sm text-[var(--color-muted)]">{message}</p>
    </div>
  );
}

/** §02 · action in flight — the inline spinner for a button or row that is working. */
export function ActionSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
    </span>
  );
}

/**
 * Route-level skeleton for /students.
 *
 * This must be the SAME shape as the client skeleton inside page.tsx, or the
 * screen flashes one layout and then a different one. It previously rendered a
 * third, unrelated shape at max-w-7xl; the roster is one responsive column at
 * max-w-3xl (Merged-Center-Students §01 draws no desktop table).
 *
 * Four `.srow` skeletons: a 38×38 rounded-xl tile, two lines at 60%/80%, and a
 * 58×22 badge pill.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] px-4 pt-4 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="space-y-2">
          <div className="h-5 w-28 animate-pulse rounded bg-[var(--color-surface-2)]" />
          <div className="h-3 w-40 animate-pulse rounded bg-[var(--color-surface-2)]" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-11 flex-1 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
          ))}
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-full bg-[var(--color-surface-2)]" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3"
            >
              <div className="h-[38px] w-[38px] shrink-0 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-[13px] w-3/5 animate-pulse rounded bg-[var(--color-surface-2)]" />
                <div className="h-[11px] w-4/5 animate-pulse rounded bg-[var(--color-surface-2)]" />
              </div>
              <div className="h-[22px] w-[58px] shrink-0 animate-pulse rounded-full bg-[var(--color-surface-2)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

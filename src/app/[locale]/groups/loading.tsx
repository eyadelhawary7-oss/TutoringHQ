/**
 * Route-level skeleton for Groups.
 *
 * Shaped to `Merged-Center-Groups` §01's loading frame (design lines 606-611):
 * four group cards — a 34px tile, a title bar, a meta bar, and the capacity
 * fill — plus the 120×11 header subtitle bar. It deliberately MATCHES the
 * in-page skeleton in `page.tsx`; before this they were different shapes, so
 * the screen visibly re-flowed when the route skeleton handed over to the
 * client one.
 */
export default function Loading() {
  const widths = [58, 50, 64, 54];
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="space-y-1.5">
          <div className="h-8 w-36 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
          <div className="h-[11px] w-[120px] bg-[var(--color-surface-2)] animate-pulse rounded-xs" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {widths.map((w, i) => (
            <div
              key={i}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-5"
            >
              <div className="mb-3.5 flex items-center gap-3">
                <div className="h-[34px] w-[34px] shrink-0 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div
                    className="mb-1.5 h-3.5 rounded-xs bg-[var(--color-surface-2)] animate-pulse"
                    style={{ width: `${w}%` }}
                  />
                  <div className="h-[11px] w-4/5 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                </div>
              </div>
              <div className="h-1.5 w-full rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

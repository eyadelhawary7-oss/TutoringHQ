/**
 * Route-segment skeleton for /dashboard.
 *
 * This is a MIRROR of the `data === null` branch in ./page.tsx, not an
 * independent design. The sequence on every navigation is
 *   loading.tsx  →  page.tsx with data === null  →  page.tsx with data,
 * so any difference between this file and that branch is a visible flash of
 * one skeleton being replaced by another. It previously painted the DELETED
 * screen (max-w-7xl mx-auto, a 4-up KPI grid, two h-64 chart panels, rounded-xl)
 * and so flashed the removed design before the §01 one appeared.
 *
 * Container classes, radii and gaps below are copied from page.tsx verbatim:
 * max-w-6xl (NOT centred — the real screen does not use mx-auto), rounded-md
 * cards on --color-panel over --color-line, gap-2 between KPI tiles, a 9px
 * rounded-pill share track, and a 52px leading block on each session row.
 *
 * Two sections the real screen can show are deliberately NOT drawn here:
 *   • the unpaid alert row — it is conditional on `unpaidCount > 0`, which is
 *     unknowable before the data lands. page.tsx omits it from its own skeleton
 *     for that reason; drawing it here would re-create the exact defect this
 *     file is being fixed for (a row that appears, then vanishes) for every
 *     centre with nothing unpaid.
 *   • the balance card (.bal) — blocked and absent from the screen entirely.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] p-4 page-enter pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6">
      <div className="max-w-6xl">
        {/* §01 .topbar — centre name, Cairo date, far-end plan pill. */}
        <header className="mb-3 flex items-center gap-2" aria-hidden>
          <div className="min-w-0">
            <div className="h-5 w-40 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
            <div className="mt-1 h-3 w-32 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
          </div>
          <div className="ms-auto h-6 w-20 shrink-0 rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
        </header>

        <div aria-busy="true">
          {/* §01 .kpis — 2×2, gap 8. */}
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
                aria-hidden
              >
                <div className="h-3 w-24 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                <div className="mt-1 h-6 w-16 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            ))}
          </div>

          {/* §01 .share — percent, total, and the 9px split track. */}
          <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4" aria-hidden>
            <div className="h-6 w-20 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
            <div className="mt-2 h-[9px] w-full rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
            <div className="mt-2 h-3 w-40 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
          </div>

          {/* §01 .sess — three rows, 52px leading time block. */}
          <div className="mt-3 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3"
                aria-hidden
              >
                <div className="h-8 w-[52px] shrink-0 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="h-3 w-28 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="mt-1 h-3 w-40 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                </div>
                <div className="h-6 w-14 shrink-0 rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

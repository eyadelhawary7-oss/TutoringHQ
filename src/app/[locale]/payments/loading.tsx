export default function Loading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-44 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        <div className="flex flex-wrap items-center gap-4 rounded-xl p-4 border border-[var(--color-border-subtle)]">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-10 flex-1 min-w-[7rem] max-w-[10rem] bg-[var(--color-surface-2)] animate-pulse rounded-xl"
            />
          ))}
        </div>
        <div className="rounded-xl border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
                <div className="h-3 w-28 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
              </div>
              <div className="h-8 w-24 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="h-8 w-36 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        <div className="rounded-xl border border-[var(--color-border-subtle)] p-6 space-y-4">
          <div className="h-6 w-40 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
          <div className="h-4 w-full max-w-md bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
          <div className="h-11 w-44 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        </div>
        <div className="h-5 w-48 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        <div className="rounded-xl border border-[var(--color-border-subtle)] overflow-hidden divide-y divide-[var(--color-border-subtle)]">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 p-4">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-36 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
                <div className="h-3 w-24 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
              </div>
              <div className="h-8 w-20 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

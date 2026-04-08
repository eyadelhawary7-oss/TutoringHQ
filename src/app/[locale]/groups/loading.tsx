export default function Loading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-36 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--color-border-subtle)] p-5 space-y-3"
            >
              <div className="h-5 w-40 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
              <div className="h-3 w-20 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
              <div className="h-8 w-full bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

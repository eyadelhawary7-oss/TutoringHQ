export default function Loading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-52 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-24 bg-[var(--color-surface-2)] animate-pulse rounded-xl"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
          <div className="h-72 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        </div>
      </div>
    </div>
  )
}

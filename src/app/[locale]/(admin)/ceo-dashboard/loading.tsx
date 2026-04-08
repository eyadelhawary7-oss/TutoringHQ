export default function Loading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-64 bg-[var(--color-surface-2)] animate-pulse rounded-xl" />
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-80 bg-[var(--color-surface-2)] animate-pulse rounded-xl"
          />
        ))}
      </div>
    </div>
  )
}

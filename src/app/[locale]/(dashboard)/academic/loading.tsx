export default function AcademicLoading() {
  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] p-4 md:p-6 space-y-6">
      <div className="h-9 w-64 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
      <div className="h-4 w-96 max-w-full rounded bg-[var(--color-surface-2)] animate-pulse" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-40 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
          <div className="h-3 w-32 rounded bg-[var(--color-surface-2)] animate-pulse mb-4" />
          <div className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        </div>
        <div className="h-40 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
          <div className="h-3 w-28 rounded bg-[var(--color-surface-2)] animate-pulse mb-4" />
          <div className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        </div>
      </div>
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
        <div className="h-10 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 border-b border-[var(--color-border-subtle)] flex items-center px-4 gap-3">
            <div className="h-4 flex-1 rounded bg-[var(--color-surface-2)] animate-pulse" />
            <div className="h-4 w-20 rounded bg-[var(--color-surface-2)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-5 flex items-center gap-3">
          <div className="p-3 rounded-full shrink-0 bg-teal-100 skeleton-pulse w-12 h-12" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-6 w-20 bg-slate-200 rounded skeleton-pulse" />
            <div className="h-3 w-24 bg-[var(--color-surface-2)] rounded skeleton-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StudentListSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-3.5 px-4">
            <div className="h-10 w-10 rounded-full bg-teal-100 skeleton-pulse shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-32 bg-slate-200 rounded skeleton-pulse" />
              <div className="h-3 w-24 bg-slate-100 rounded skeleton-pulse" />
              <div className="h-3 w-20 bg-slate-100 rounded skeleton-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

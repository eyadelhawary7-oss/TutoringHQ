import {
  SkeletonStat,
  SkeletonChart,
  SkeletonPageHeader,
  SkeletonText,
  SkeletonBlock,
} from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <SkeletonPageHeader />

      {/* Stat cards row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>

      {/* Main chart */}
      <SkeletonChart className="mb-6" />

      {/* Weekly performance row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 flex flex-col gap-2"
               aria-hidden="true">
            <SkeletonText className="w-28 h-3" />
            <SkeletonText className="w-16 h-6" />
          </div>
        ))}
      </div>

      {/* Quick actions row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16" />
        ))}
      </div>
    </div>
  )
}

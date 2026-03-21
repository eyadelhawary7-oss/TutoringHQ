import {
  SkeletonPageHeader,
  SkeletonChart,
  SkeletonStat,
} from '@/components/ui/skeleton'

export default function AnalyticsLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen
                    p-4 md:p-6
                    pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <SkeletonPageHeader />

      {/* KPI stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    </div>
  )
}

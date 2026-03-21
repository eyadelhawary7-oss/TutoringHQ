import {
  SkeletonPageHeader,
  SkeletonFilterBar,
  SkeletonRow,
  SkeletonBlock,
} from '@/components/ui/skeleton'

export default function AttendanceLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen
                    p-4 md:p-6
                    pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <SkeletonPageHeader />
      <SkeletonFilterBar />

      {/* Heatmap placeholder */}
      <SkeletonBlock className="w-full h-40 mb-6" />

      <div className="card overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  )
}

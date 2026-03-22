import {
  SkeletonPageHeader,
  SkeletonFilterBar,
  SkeletonRow,
  SkeletonText,
} from '@/components/ui/skeleton'

export default function PaymentsLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <SkeletonPageHeader />

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-4 flex flex-col gap-2"
               aria-hidden="true">
            <SkeletonText className="w-20 h-3" />
            <SkeletonText className="w-24 h-6" />
          </div>
        ))}
      </div>

      <SkeletonFilterBar />

      <div className="card overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  )
}

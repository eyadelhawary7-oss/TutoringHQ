import {
  SkeletonPageHeader,
  SkeletonFilterBar,
  SkeletonRow,
} from '@/components/ui/skeleton'

export default function StudentsLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen
                    p-4 md:p-6
                    pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <SkeletonPageHeader />
      <SkeletonFilterBar />

      <div className="card overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  )
}

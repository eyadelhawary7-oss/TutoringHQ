import {
  SkeletonPageHeader,
  SkeletonBlock,
  SkeletonText,
} from '@/components/ui/skeleton'

export default function GroupsLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen
                    p-4 md:p-6
                    pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">
      <SkeletonPageHeader />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-5 flex flex-col gap-3"
               aria-hidden="true">
            <SkeletonText className="w-36 h-5" />
            <SkeletonText className="w-24 h-3" />
            <div className="flex items-center justify-between pt-2">
              <SkeletonText className="w-20 h-4" />
              <SkeletonBlock className="w-16 h-7 rounded-badge" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

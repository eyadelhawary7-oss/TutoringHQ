import {
  SkeletonBlock,
  SkeletonText,
} from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6">

      {/* Tab pills */}
      <div className="flex gap-2 mb-6" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="w-24 h-9 rounded-badge" />
        ))}
      </div>

      {/* Settings sections */}
      <div className="flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-6 flex flex-col gap-4"
               aria-hidden="true">
            <SkeletonText className="w-40 h-5" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex flex-col gap-1">
                  <SkeletonText className="w-24 h-3" />
                  <SkeletonBlock className="w-full h-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

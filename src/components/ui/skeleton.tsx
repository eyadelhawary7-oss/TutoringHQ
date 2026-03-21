// Reusable skeleton primitives built on the S1 .skeleton class.
// All components are server-safe — no 'use client' needed.

type SkeletonProps = {
  className?: string
}

// Single text line
export function SkeletonText({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton h-4 rounded-sm ${className}`}
      aria-hidden="true"
    />
  )
}

// Circle — for avatars, icons
export function SkeletonCircle({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton rounded-full ${className}`}
      aria-hidden="true"
    />
  )
}

// Generic block — for images, charts, any rectangle
export function SkeletonBlock({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton rounded-card ${className}`}
      aria-hidden="true"
    />
  )
}

// Stat card — matches the 4-up stat card layout on dashboard
export function SkeletonStat() {
  return (
    <div className="card p-5 flex flex-col gap-3" aria-hidden="true">
      <div className="flex items-center justify-between">
        <SkeletonText className="w-24" />
        <SkeletonCircle className="w-9 h-9" />
      </div>
      <SkeletonText className="w-16 h-7" />
      <SkeletonText className="w-20 h-3" />
    </div>
  )
}

// List row — matches student/payment list item shape
export function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3
                 border-b border-[var(--color-border-subtle)]"
      aria-hidden="true"
    >
      <SkeletonCircle className="w-9 h-9 flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <SkeletonText className="w-32" />
        <SkeletonText className="w-20 h-3" />
      </div>
      <SkeletonText className="w-16 h-6 rounded-badge" />
    </div>
  )
}

// Page header — title + optional action button
export function SkeletonPageHeader() {
  return (
    <div
      className="flex items-center justify-between mb-6"
      aria-hidden="true"
    >
      <div className="flex flex-col gap-2">
        <SkeletonText className="w-40 h-7" />
        <SkeletonText className="w-56 h-4" />
      </div>
      <SkeletonBlock className="w-32 h-9" />
    </div>
  )
}

// Search + filter bar
export function SkeletonFilterBar() {
  return (
    <div
      className="flex items-center gap-3 mb-4"
      aria-hidden="true"
    >
      <SkeletonBlock className="flex-1 h-10" />
      <SkeletonBlock className="w-24 h-10" />
      <SkeletonBlock className="w-24 h-10" />
    </div>
  )
}

// Chart area
export function SkeletonChart({ className = '' }: SkeletonProps) {
  return (
    <div className={`card p-5 ${className}`} aria-hidden="true">
      <SkeletonText className="w-36 h-5 mb-4" />
      <SkeletonBlock className="w-full h-48 md:h-64" />
    </div>
  )
}

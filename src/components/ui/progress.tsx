'use client';

import { cn } from '@/lib/utils';

interface ProgressProps {
  value?: number;
  className?: string;
}

export function Progress({ value = 0, className }: ProgressProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('relative overflow-hidden rounded-full bg-secondary', className)}
    >
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
    </div>
  );
}

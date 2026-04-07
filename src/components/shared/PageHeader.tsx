'use client';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: string;
  children?: React.ReactNode;
  titleClassName?: string;
  subtitleClassName?: string;
}

export default function PageHeader({
  title,
  subtitle,
  children,
  titleClassName,
  subtitleClassName,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className={cn('text-2xl font-bold text-[var(--color-text-primary)]', titleClassName)}>{title}</h1>
        {subtitle && (
          <p className={cn('text-sm text-[var(--color-text-muted)] mt-0.5', subtitleClassName)}>{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
